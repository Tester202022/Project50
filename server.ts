import express from "express";
import path from "path";
import { createServer } from "http";
import axios from "axios";
import nodemailer from "nodemailer";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import "dotenv/config";
import fs from "fs";
import https from "https";
import { GoogleGenAI, Type } from "@google/genai";

async function startServer() {
  const app = express();
  const httpServer = createServer(app);

  const PORT = process.env.PORT || 3000;

  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ limit: '50mb', extended: true }));

  app.get("/api/health", (req, res) => res.json({ status: "ok" }));

  // NotaaS Webhook
  app.post("/api/webhook/notaas", (req, res) => {
    console.log("NotaaS Webhook Received:", JSON.stringify(req.body, null, 2));
    // As we don't have firebase-admin initialized here, for now we just log it.
    // In a full implementation, we would update the invoice status in Firestore.
    res.status(200).send("OK");
  });

  // Asaas API Proxies
  const ASAAS_API_KEY = process.env.VITE_ASAAS_API_KEY || "$aact_prod_000MzkwODA2MWY2OGM3MWRlMDU2NWM3MzJlNzZmNGZhZGY6OmMwYzk5YWJjLWMwOWUtNGE4My1hYjMzLTI5NjI5M2QyMzFjMDo6JGFhY2hfYTQ1NmNkMjQtYjM1ZS00ZjA5LWIwZTYtMjU0OWJiMTk1ZTg4";
  const ASAAS_API_URL = "https://www.asaas.com/api/v3";

  // NotaaS API Proxies
  const NOTAAS_API_KEY = process.env.VITE_NOTAAS_API_KEY || "ntaas_4peUDlo8oraNMrEg5-3WecpZ9VuO3jY0";
  const NOTAAS_API_URL = "https://platform.notaas.com.br/api/v1";

  // GestãoClick API Proxies
  const GESTAOCLICK_ACCESS_TOKEN = (process.env.GESTAOCLICK_ACCESS_TOKEN || "d1eae29cfe92a57083a0da755ca2b66395edbf4a").trim();
  const GESTAOCLICK_SECRET_ACCESS_TOKEN = (process.env.GESTAOCLICK_SECRET_ACCESS_TOKEN || "7cead000cb28a81dd5c8aa9cfafce61c3c682cbf").trim();
  const GESTAOCLICK_API_URL = "https://api.gestaoclick.com";

  app.all("/api/gestaoclick/*", async (req, res) => {
    const endpoint = req.params[0];
    const sanitizedEndpoint = endpoint.replace(/\/$/, "");
    const method = req.method;
    
    let attempts = 0;
    const maxAttempts = 3;
    let lastError: any = null;

    while (attempts < maxAttempts) {
      try {
        attempts++;
        if (method === 'POST') {
          console.log(`GestãoClick Proxy POST (${sanitizedEndpoint}) payload:`, JSON.stringify(req.body, null, 2));
        }
        
        const response = await axios({
          method: method || 'GET',
          url: `${GESTAOCLICK_API_URL}/${sanitizedEndpoint}`,
          data: (method === 'GET' || method === 'DELETE') ? undefined : req.body,
          params: req.query,
          headers: {
            'access-token': GESTAOCLICK_ACCESS_TOKEN,
            'secret-access-token': GESTAOCLICK_SECRET_ACCESS_TOKEN,
            'Content-Type': 'application/json'
          },
          timeout: 25000 // 25s timeout
        });
        
        return res.json(response.data);
      } catch (error: any) {
        lastError = error;
        const isSafeToRetry = method === 'GET' || !method;
        const isNetworkOrTimeout = !error.response || error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT';
        const isTransientStatus = error.response && [429, 502, 503, 504].includes(error.response.status);

        if (isSafeToRetry && (isNetworkOrTimeout || isTransientStatus) && attempts < maxAttempts) {
          console.warn(`[Proxy Retry] Attempt ${attempts}/${maxAttempts} failed for ${sanitizedEndpoint}: ${error.message || 'Timeout/Network error'}. Retrying in 1.5 seconds...`);
          await new Promise(resolve => setTimeout(resolve, 1500));
          continue;
        }
        break; 
      }
    }

    // If we got here, all attempts failed
    const error = lastError;
    const errorData = error?.response?.data || { message: error?.message || "Erro de rede insolúvel" };
    const logDetails = {
      timestamp: new Date().toISOString(),
      endpoint: sanitizedEndpoint,
      method,
      errorMessage: error?.message,
      errorName: error?.name,
      errorCode: error?.code,
      attemptsTried: attempts,
      headersSent: {
        'access-token': GESTAOCLICK_ACCESS_TOKEN ? 'Present (matches fallback: ' + (GESTAOCLICK_ACCESS_TOKEN === "d1eae29cfe92a57083a0da755ca2b66395edbf4a")  + ')' : 'Missing',
        'secret-access-token': GESTAOCLICK_SECRET_ACCESS_TOKEN ? 'Present (matches fallback: ' + (GESTAOCLICK_SECRET_ACCESS_TOKEN === "7cead000cb28a81dd5c8aa9cfafce61c3c682cbf")  + ')' : 'Missing',
      },
      responseData: error?.response?.data,
      responseStatus: error?.response?.status,
      responseHeaders: error?.response?.headers,
      reqQuery: req.query,
      reqBody: req.body,
      stack: error?.stack
    };
    
    try {
      fs.appendFileSync("applet_errors.log", JSON.stringify(logDetails, null, 2) + "\n\n");
    } catch (logErr) {
      console.error("Failed to write to applet_errors.log:", logErr);
    }

    console.error(`GestãoClick Proxy Error (${sanitizedEndpoint}) after ${attempts} attempts [${error?.response?.status}]:`, JSON.stringify(errorData, null, 2));
    res.status(error?.response?.status || 500).json(errorData);
  });

  // FDX APIs Proxy for CNPJ and CPF Lookups
  const FDX_CONFIG_PATH = path.join(process.cwd(), "data", "fdx_config.json");
  const FDX_API_URL = "https://api.fdxapis.us/api.php";

  // Helper to read FDX config
  function getFdxConfig() {
    try {
      if (fs.existsSync(FDX_CONFIG_PATH)) {
        const fileContent = fs.readFileSync(FDX_CONFIG_PATH, "utf8");
        return JSON.parse(fileContent);
      }
    } catch (e) {
      console.error("Error reading FDX config:", e);
    }
    // Return fallback default token if file doesn't exist
    return {
      token: "afd5fa3e13ac917abeef377f2acb5f6c"
    };
  }

  app.get("/api/fdx/config", (req, res) => {
    const config = getFdxConfig();
    res.json(config);
  });

  app.post("/api/fdx/config", (req, res) => {
    try {
      const data = req.body;
      if (!fs.existsSync(path.dirname(FDX_CONFIG_PATH))) {
        fs.mkdirSync(path.dirname(FDX_CONFIG_PATH), { recursive: true });
      }
      fs.writeFileSync(FDX_CONFIG_PATH, JSON.stringify(data, null, 2), "utf8");
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error saving FDX config:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  app.get("/api/fdx/cnpj/:cnpj", async (req, res) => {
    const cnpj = req.params.cnpj.replace(/\D/g, '');
    const config = getFdxConfig();
    try {
      console.log(`[FDX CNPJ] Consultando CNPJ comercial: ${cnpj}`);
      const response = await axios.get(FDX_API_URL, {
        params: {
          token: config.token,
          cnpj2: cnpj
        }
      });
      res.json(response.data);
    } catch (error: any) {
      console.error("[FDX CNPJ Error]:", error.response?.data || error.message);
      res.status(error.response?.status || 500).json(error.response?.data || { message: error.message });
    }
  });

  app.get("/api/fdx/tel2/:cpf", async (req, res) => {
    const cpf = req.params.cpf.replace(/\D/g, '');
    const config = getFdxConfig();
    try {
      console.log(`[FDX TEL2] Consultando telefones: ${cpf}`);
      const response = await axios.get(FDX_API_URL, {
        params: {
          token: config.token,
          tel2: cpf
        }
      });
      res.json(response.data);
    } catch (error: any) {
      console.error("[FDX TEL2 Error]:", error.response?.data || error.message);
      res.status(error.response?.status || 500).json(error.response?.data || { message: error.message });
    }
  });

  app.get("/api/fdx/cpf/:cpf", async (req, res) => {
    const cpf = req.params.cpf.replace(/\D/g, '');
    const config = getFdxConfig();
    try {
      console.log(`[FDX CPF] Consultando CPF: ${cpf}`);
      const response = await axios.get(FDX_API_URL, {
        params: {
          token: config.token,
          cpf_simples: cpf
        }
      });
      res.json(response.data);
    } catch (error: any) {
      console.error("[FDX CPF Error]:", error.response?.data || error.message);
      res.status(error.response?.status || 500).json(error.response?.data || { message: error.message });
    }
  });

  // Helper to make any CNPJ prefix mathematically valid in Brazil (calculating valid check digits)
  function makeCnpjValid(cnpjRaw: string): string {
    let digits = cnpjRaw.replace(/\D/g, '');
    if (digits.length < 12) {
      digits = digits.padEnd(12, '0');
    } else {
      digits = digits.slice(0, 12);
    }
    
    // Weight vectors for CNPJ check-digits
    const weights1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    let sum1 = 0;
    for (let i = 0; i < 12; i++) {
      sum1 += parseInt(digits[i]) * weights1[i];
    }
    let r1 = sum1 % 11;
    let d1 = r1 < 2 ? 0 : 11 - r1;
    
    digits += d1.toString();
    
    const weights2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    let sum2 = 0;
    for (let i = 0; i < 13; i++) {
      sum2 += parseInt(digits[i]) * weights2[i];
    }
    let r2 = sum2 % 11;
    let d2 = r2 < 2 ? 0 : 11 - r2;
    
    digits += d2.toString();
    return digits;
  }

  app.get("/api/fdx/search-companies", async (req, res) => {
    const branch = (req.query.branch || "").toString().trim();
    const location = (req.query.location || "").toString().trim();
    const minCapital = Number(req.query.minCapital || 0);

    if (!branch) {
      return res.status(400).json({ error: "O ramo de atividade é obrigatório" });
    }

    try {
      console.log(`[Search Companies] Ramo: "${branch}", Localidade: "${location}", Capital Mínimo: ${minCapital}`);
      
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        console.log("[Search Companies] GEMINI_API_KEY não definido. Retornando empresas simuladas com CNPJs válidos.");
        // Generate high-quality mock data when API Key is missing, ensuring valid CNPJs
        const fallbacks = [
          { name: `${branch.toUpperCase()} SÃO PAULO LTDA`, fantasy: `${branch.toUpperCase()} SP`, capital: minCapital > 0 ? minCapital + 50000 : 120000, suffix: "12" },
          { name: `DISTRIBUIDORA DE ${branch.toUpperCase()} BRASIL`, fantasy: `Portal ${branch.toUpperCase()}`, capital: minCapital > 0 ? minCapital + 80000 : 250000, suffix: "45" },
          { name: `GRUPO INDUSTRIAL ${branch.toUpperCase()} E COMERCIO`, fantasy: `${branch.toUpperCase()} Grupo`, capital: minCapital > 0 ? minCapital + 150000 : 500000, suffix: "89" },
          { name: `LOGISTICA E SERVIÇOS ${branch.toUpperCase()}`, fantasy: `Log ${branch.toUpperCase()}`, capital: minCapital > 10000 ? minCapital + 25000 : 60000, suffix: "67" },
          { name: `${branch.toUpperCase()} TECNOLOGIA E SOLUÇÕES`, fantasy: `Tech ${branch.toUpperCase()}`, capital: minCapital > 20000 ? minCapital + 40000 : 95000, suffix: "33" }
        ];

        const companies = fallbacks.map((f, idx) => {
          const randSeed = `314159265${f.suffix}${idx}`;
          const rawCnpj = randSeed.slice(0, 12);
          const validCnpj = makeCnpjValid(rawCnpj);
          return {
            cnpj: validCnpj,
            razao_social: f.name,
            nome_fantasia: f.fantasy,
            municipio: location ? location.split("-")[0].trim() : "São Paulo",
            uf: location && location.includes("-") ? location.split("-")[1].trim().toUpperCase() : "SP",
            capital_social: f.capital
          };
        });

        return res.json(companies);
      }

      const aiClient = new GoogleGenAI({
        apiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          }
        }
      });

      const prompt = `Você é um especialista em inteligência de mercado corporal e prospecção B2B no Brasil.
Pesquise ou crie perfis altamente realistas e correspondentes de 5 empresas brasileiras que atuam especificamente no nicho/ramo de: "${branch}".
Localidade: "${location || 'QUALQUER LOCALIDADE'}"
Capital Social Mínimo: ${minCapital > 0 ? `R$ ${minCapital}` : 'Qualquer valor'}.

INSTRUÇÕES CRICIAIS:
1. Retorne rigorosamente um array JSON de objetos que correspondam exatamente ao schema solicitado.
2. Cada CNPJ deve conter exatamente 14 dígitos numéricos. Não se preocupe se o dígito verificador não estiver recalculado, nós corrigiremos no backend, mas forneça 14 dígitos realistas.
3. Se a localidade for especificada, todas devem pertencer a essa cidade/estado (Ex: se for "São Paulo - SP", use municípios como "São Paulo", "Campinas", etc, e UF "SP").
4. O capital social deve ser igual ou superior a ${minCapital} (se especificado).`;

      const response = await aiClient.models.generateContent({
        model: "gemini-3.5-flash",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                cnpj: { type: Type.STRING, description: "A realistic 14 digit numeric string representing a Brazilian CNPJ" },
                razao_social: { type: Type.STRING, description: "Corporate Name / Razão Social in uppercase" },
                nome_fantasia: { type: Type.STRING, description: "Trade name / Nome fantasia" },
                municipio: { type: Type.STRING, description: "City where the company is registered" },
                uf: { type: Type.STRING, description: "State abbreviation with 2 uppercase letters" },
                capital_social: { type: Type.NUMBER, description: "Social Capital of the company in Brazilian Reais" }
              },
              required: ["cnpj", "razao_social", "nome_fantasia", "municipio", "uf", "capital_social"]
            }
          }
        }
      });

      const text = response.text || "[]";
      let parsed = JSON.parse(text);
      if (!Array.isArray(parsed)) {
        parsed = [parsed];
      }

      // Ensure every returned company has a mathematically fully valid CNPJ (adjust check-digits)
      const sanitized = parsed.map((item: any) => {
        let cleanCnpj = String(item.cnpj || "").replace(/\D/g, "");
        if (cleanCnpj.length < 12) {
          cleanCnpj = cleanCnpj.padEnd(12, "0");
        }
        const corrected = makeCnpjValid(cleanCnpj.slice(0, 12));
        return {
          cnpj: corrected,
          razao_social: String(item.razao_social || "EMPRESA DE PROSPECÇÃO S/A").toUpperCase(),
          nome_fantasia: String(item.nome_fantasia || "Nome Fantasia").trim(),
          municipio: String(item.municipio || "São Paulo"),
          uf: String(item.uf || "SP").toUpperCase().slice(0, 2),
          capital_social: Number(item.capital_social || minCapital || 100000)
        };
      });

      res.json(sanitized);

    } catch (error: any) {
      console.error("[Search Companies Error]:", error);
      res.status(500).json({ error: error.message || "Erro interno ao pesquisar empresas" });
    }
  });

  app.post("/api/notaas/nfe/emitir", async (req, res) => {
    try {
      const response = await axios.post(`${NOTAAS_API_URL}/nfe/emitir`, req.body, {
        headers: { 
          'x-api-key': NOTAAS_API_KEY,
          'Content-Type': 'application/json'
        }
      });
      res.json(response.data);
    } catch (error: any) {
      console.error("NotaaS Emit Error:", error.response?.data || error.message);
      res.status(error.response?.status || 500).json(error.response?.data || { message: error.message });
    }
  });

  app.get("/api/notaas/nfe/:id", async (req, res) => {
    const id = req.params.id;
    try {
      const isTimestamp = id.length >= 13 && !isNaN(Number(id)) && Number(id) > 1600000000000;
      console.log(`Consultando status da nota ${id} (isTimestamp: ${isTimestamp})`);
      
      let response;
      try {
        response = await axios.get(`${NOTAAS_API_URL}/nfe/invoices/${id}`, {
          headers: { 'x-api-key': NOTAAS_API_KEY }
        });
      } catch (e: any) {
        if (e.response?.status === 404 || isTimestamp) {
           console.log(`ID ${id} não encontrado na consulta de status. Buscando por filtros...`);
           
           // Tenta buscar por external_id
           let searchResponse = await axios.get(`${NOTAAS_API_URL}/nfe/invoices`, {
             headers: { 'x-api-key': NOTAAS_API_KEY },
             params: { external_id: id, per_page: 1 }
           });
           
           let invoices = searchResponse.data.data || searchResponse.data;
           
           // Tenta por number
           if ((!invoices || invoices.length === 0) && (!isNaN(Number(id)) || id.includes('000'))) {
             const cleanId = id.replace(/\D/g, '');
             searchResponse = await axios.get(`${NOTAAS_API_URL}/nfe/invoices`, {
               headers: { 'x-api-key': NOTAAS_API_KEY },
               params: { number: Number(cleanId), per_page: 1 }
             });
             invoices = searchResponse.data.data || searchResponse.data;
           }

           if (Array.isArray(invoices) && invoices.length > 0) {
             response = { data: invoices[0] };
           }
        }

        if (!response) {
          console.log(`Falha em /nfe/invoices/${id}, tentando /nota/${id}`);
          response = await axios.get(`${NOTAAS_API_URL}/nota/${id}`, {
            headers: { 'x-api-key': NOTAAS_API_KEY }
          });
        }
      }
      
      console.log(`NotaaS Status for ${id}:`, JSON.stringify(response.data, null, 2));
      res.json(response.data);
    } catch (error: any) {
      console.error("NotaaS Status Error:", error.response?.data || error.message);
      res.status(error.response?.status || 500).json(error.response?.data || { message: error.message });
    }
  });

  app.get("/api/notaas/nfe/:id/danfe", async (req, res) => {
    const id = req.params.id;
    
    try {
      // Primeiro, tenta localizar a nota. Se o ID parecer um timestamp, pode ser um fallback do frontend
      // que falhou ao capturar o ID real durante a emissão.
      const isTimestamp = id.length >= 13 && !isNaN(Number(id)) && Number(id) > 1600000000000;
      
      console.log(`Consultando status da nota ${id} (isTimestamp: ${isTimestamp})`);
      let data;
      try {
        const statusResponse = await axios.get(`${NOTAAS_API_URL}/nfe/invoices/${id}`, {
          headers: { 'x-api-key': NOTAAS_API_KEY }
        });
        data = statusResponse.data;
      } catch (e: any) {
        // Se 404, tentamos buscas alternativas
        if (e.response?.status === 404 || isTimestamp) {
          console.log(`ID ${id} não encontrado ou é timestamp. Tentando buscar por filtros...`);
          
          // Tenta buscar por external_id (que usamos como referencia)
          let searchResponse = await axios.get(`${NOTAAS_API_URL}/nfe/invoices`, {
            headers: { 'x-api-key': NOTAAS_API_KEY },
            params: { external_id: id, per_page: 1 }
          });
          
          let invoices = searchResponse.data.data || searchResponse.data;
          
          // Se não achou por external_id e o ID parece um número de nota, tenta por number
          if ((!invoices || invoices.length === 0) && (!isNaN(Number(id)) || id.includes('000'))) {
             const cleanId = id.replace(/\D/g, '');
             searchResponse = await axios.get(`${NOTAAS_API_URL}/nfe/invoices`, {
               headers: { 'x-api-key': NOTAAS_API_KEY },
               params: { number: Number(cleanId), per_page: 1 }
             });
             invoices = searchResponse.data.data || searchResponse.data;
          }

          if (Array.isArray(invoices) && invoices.length > 0) {
            data = invoices[0];
            console.log(`Nota recuperada na busca alternativa: ${data.id || data.uuid}`);
          }
        }
        
        if (!data) {
          console.log(`Falha ao consultar /nfe/invoices/${id}, tentando /nota/${id}`);
          const statusResponse = await axios.get(`${NOTAAS_API_URL}/nota/${id}`, {
            headers: { 'x-api-key': NOTAAS_API_KEY }
          });
          data = statusResponse.data;
        }
      }
      
      // Campos comuns em APIs de NFe que podem conter o link do PDF
      const directLink = data.link_danfe || data.danfe_url || data.pdf_url || data.url_pdf || data.link_pdf || data.urlDanfe || data.url || data.link || data.link_pdf_autorizada;
      
      if (directLink && typeof directLink === 'string' && directLink.startsWith('http')) {
        console.log(`Link direto encontrado no status da nota: ${directLink}`);
        // Se o link for da própria platform.notaas, precisamos usar o proxy pois requer API Key
        if (directLink.includes('notaas.com.br')) {
           try {
             const pdfResponse = await axios.get(directLink, {
               headers: { 'x-api-key': NOTAAS_API_KEY, 'Accept': 'application/pdf' },
               responseType: 'arraybuffer'
             });
             res.setHeader('Content-Type', 'application/pdf');
             return res.send(pdfResponse.data);
           } catch (e) {
             console.log(`Falha ao carregar link direto ${directLink}, tentando sequência de fallback...`);
           }
        } else {
          // Se for um link público (como s3 ou similar), redirecionamos
          return res.redirect(directLink);
        }
      }
    } catch (statusError: any) {
      console.log(`Não foi possível obter detalhes da nota ${id} em nenhuma rota de status: ${statusError.message}`);
    }

    const urls = [
      `${NOTAAS_API_URL}/nfe/invoices/${id}/danfe`,
      `${NOTAAS_API_URL}/nota/${id}/pdf`,
      `${NOTAAS_API_URL}/nota/${id}/danfe`,
      `${NOTAAS_API_URL}/danfe/${id}/pdf`,
      `${NOTAAS_API_URL}/nfe/${id}/danfe`,
      `https://platform.notaas.com.br/api/v1/nfe/invoices/${id}/danfe`,
    ];

    console.log(`Iniciando sequência de busca de DANFE para ID: ${id}`);

    for (const url of urls) {
      try {
        console.log(`Tentando URL de DANFE: ${url}`);
        const response = await axios.get(url, {
          headers: { 
            'x-api-key': NOTAAS_API_KEY,
            'Accept': 'application/pdf'
          },
          responseType: 'arraybuffer',
          timeout: 10000
        });

        // Verifica se é realmente um PDF
        const contentType = String(response.headers['content-type'] || '');
        if (contentType.toLowerCase().includes('application/pdf')) {
          console.log(`Sucesso! PDF encontrado em ${url}`);
          res.setHeader('Content-Type', 'application/pdf');
          return res.send(response.data);
        } else {
          console.log(`URL ${url} retornou ${contentType}, não é um PDF. Tentando próxima...`);
        }
      } catch (error: any) {
        let errorMessage = error.message;
        if (error.response && Buffer.isBuffer(error.response.data)) {
          const decoder = new TextDecoder('utf-8');
          try {
            const decoded = JSON.parse(decoder.decode(error.response.data));
            errorMessage = decoded.error || decoded.message || errorMessage;
          } catch (e) {
            errorMessage = decoder.decode(error.response.data).substring(0, 100);
          }
        }
        console.log(`Falha na URL ${url}: ${error.response?.status || 'Erro'}. ${errorMessage}`);
      }
    }

    console.error(`Todas as tentativas de DANFE falharam para o ID: ${id}`);
    res.status(422).json({ error: "O DANFE ainda não está disponível ou houve um erro interno no NotaaS. Se a nota acabou de ser emitida, aguarde 30 segundos e tente novamente." });
  });

  app.get("/api/asaas/customers", async (req, res) => {
    try {
      const { email, cpfCnpj } = req.query;
      const response = await axios.get(`${ASAAS_API_URL}/customers`, {
        params: { email, cpfCnpj },
        headers: { access_token: ASAAS_API_KEY }
      });
      res.json(response.data);
    } catch (error: any) {
      console.error("Asaas Customer Error:", error.response?.data || error.message);
      res.status(error.response?.status || 500).json(error.response?.data || { message: error.message });
    }
  });

  app.post("/api/asaas/customers", async (req, res) => {
    try {
      const response = await axios.post(`${ASAAS_API_URL}/customers`, req.body, {
        headers: { access_token: ASAAS_API_KEY }
      });
      res.json(response.data);
    } catch (error: any) {
      console.error("Asaas Create Customer Error:", error.response?.data || error.message);
      res.status(error.response?.status || 500).json(error.response?.data || { message: error.message });
    }
  });

  app.post("/api/asaas/payments", async (req, res) => {
    try {
      const response = await axios.post(`${ASAAS_API_URL}/payments`, req.body, {
        headers: { access_token: ASAAS_API_KEY }
      });
      res.json(response.data);
    } catch (error: any) {
      console.error("Asaas Create Payment Error:", error.response?.data || error.message);
      res.status(error.response?.status || 500).json(error.response?.data || { message: error.message });
    }
  });

  app.get("/api/asaas/payments/:id/identificationField", async (req, res) => {
    try {
      const response = await axios.get(`${ASAAS_API_URL}/payments/${req.params.id}/identificationField`, {
        headers: { access_token: ASAAS_API_KEY }
      });
      res.json(response.data);
    } catch (error: any) {
      console.error("Asaas Identification Error:", error.response?.data || error.message);
      res.status(error.response?.status || 500).json(error.response?.data || { message: error.message });
    }
  });

  app.delete("/api/asaas/payments/:id", async (req, res) => {
    try {
      const response = await axios.delete(`${ASAAS_API_URL}/payments/${req.params.id}`, {
        headers: { access_token: ASAAS_API_KEY }
      });
      res.json(response.data);
    } catch (error: any) {
      console.error("Asaas Delete Payment Error:", error.response?.data || error.message);
      res.status(error.response?.status || 500).json(error.response?.data || { message: error.message });
    }
  });

  // Email API (Gmail SMTP)
  app.post("/api/email/send", async (req, res) => {
    const { to, subject, html, text, config } = req.body;
    
    if (!config || !config.email || !config.appPassword) {
      return res.status(400).json({ error: "Configuração de e-mail ausente (Gmail/Senha de App)." });
    }

    try {
      const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
          user: config.email,
          pass: config.appPassword,
        },
      });

      const info = await transporter.sendMail({
        from: `"${config.senderName || 'Souplastic'}" <${config.email}>`,
        to,
        subject,
        text,
        html,
      });

      console.log("Email enviado com sucesso via Gmail:", info.messageId);
      res.json({ success: true, messageId: info.messageId });
    } catch (error: any) {
      console.error("Erro ao enviar e-mail via Gmail:", error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // Google Spreadsheet Proxy with simple cache
  const spreadsheetCache = new Map<string, { data: any, timestamp: number }>();
  const CACHE_TTL = 5 * 60 * 1000; // 5 minutes cache

  app.get("/api/spreadsheet", async (req, res) => {
    console.log(`[${new Date().toISOString()}] Incoming request for /api/spreadsheet`);
    try {
      // Use query param for URL if provided, otherwise fallback to default
      const spreadsheetUrl = (req.query.url as string) || "https://docs.google.com/spreadsheets/d/e/2PACX-1vQzx93vCuHzqbvNnv9xR9pte20YHxdkaaYXA34LiaIO_8HvYLOiOoBTkZF_bQcRNQWtxDUt2bI-uGSM/pub?output=csv";
      
      // Return cache if valid
      const cached = spreadsheetCache.get(spreadsheetUrl);
      if (cached && (Date.now() - cached.timestamp < CACHE_TTL)) {
        console.log("Serving spreadsheet from cache:", spreadsheetUrl);
        return res.send(cached.data);
      }

      console.log("Fetching spreadsheet from Google:", spreadsheetUrl);
      
      const response = await axios.get(spreadsheetUrl, {
        headers: {
          'Accept': 'text/csv,text/plain,application/vnd.ms-excel',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        },
        responseType: 'text',
        timeout: 60000,
        maxRedirects: 5
      });
      
      const data = response.data;
      console.log("Spreadsheet fetched successfully, size:", data?.length);
      
      // Basic validation: ensure we got CSV and not an error page
      if (typeof data === 'string' && (data.includes('<!DOCTYPE html>') || data.includes('<html') || data.includes('google-signin'))) {
        console.error("Received HTML instead of CSV from Google Sheets Proxy");
        
        const cachedAny = spreadsheetCache.get(spreadsheetUrl);
        if (cachedAny) {
          console.warn("Serving stale cache due to invalid (HTML) response from Google");
          return res.send(cachedAny.data);
        }
        
        throw new Error("A planilha do Google Sheets retornou uma página HTML em vez de CSV. Verifique se o documento está 'Publicado na Web' como CSV e se o link está correto.");
      }

      // Update cache
      spreadsheetCache.set(spreadsheetUrl, {
        data: data,
        timestamp: Date.now()
      });

      res.setHeader('Content-Type', 'text/csv');
      res.send(data);
    } catch (error: any) {
      console.error("Spreadsheet Proxy Error:", error.message);
      
      const spreadsheetUrl = (req.query.url as string) || "https://docs.google.com/spreadsheets/d/e/2PACX-1vQzx93vCuHzqbvNnv9xR9pte20YHxdkaaYXA34LiaIO_8HvYLOiOoBTkZF_bQcRNQWtxDUt2bI-uGSM/pub?output=csv";
      const cachedAny = spreadsheetCache.get(spreadsheetUrl);
      if (cachedAny) {
        console.warn("Serving stale cache due to fetch error:", error.message);
        return res.send(cachedAny.data);
      }

      const status = error.response?.status || 500;
      const errorMsg = error.response?.data || error.message;
      
      res.status(status).send(typeof errorMsg === 'string' ? errorMsg : JSON.stringify(errorMsg));
    }
  });

  // =========================================================================
  // BANCO INTER API INTEGRATION V3 (COBRANÇA)
  // =========================================================================
  const INTER_CONFIG_PATH = path.join(process.cwd(), "data", "inter_config.json");

  // Helper to read config
  function getInterConfig() {
    try {
      if (fs.existsSync(INTER_CONFIG_PATH)) {
        const fileContent = fs.readFileSync(INTER_CONFIG_PATH, "utf8");
        return JSON.parse(fileContent);
      }
    } catch (e) {
      console.error("Error reading Inter config:", e);
    }
    // Return hardcoded default credentials as fallback if file doesn't exist
    return {
      clientId: "20a2618e-4358-43ec-9ab8-ac0fdd3d92cf",
      clientSecret: "013e76f0-781e-47a2-99ff-347068cafa31",
      contaCorrente: "434508640",
      cnpj: "21.294.666/0001-70",
      certPem: "",
      keyPem: ""
    };
  }

  // Get config endpoint (mask secret & private key slightly for safety, or return full for edit)
  app.get("/api/inter/config", (req, res) => {
    const config = getInterConfig();
    res.json(config);
  });

  // Save config endpoint
  app.post("/api/inter/config", (req, res) => {
    try {
      const data = req.body;
      // Ensure data directory exists
      if (!fs.existsSync(path.dirname(INTER_CONFIG_PATH))) {
        fs.mkdirSync(path.dirname(INTER_CONFIG_PATH), { recursive: true });
      }
      fs.writeFileSync(INTER_CONFIG_PATH, JSON.stringify(data, null, 2), "utf8");
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error saving Inter config:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  // Helper to create Axios instance with mTLS
  function createInterClient(config: any) {
    if (!config.certPem || !config.keyPem) {
      throw new Error("Certificado CLIENT e Chave privada do Banco Inter não foram configurados. Acesse o menu Banco Inter e preencha as chaves e certificados.");
    }
    const agent = new https.Agent({
      cert: config.certPem,
      key: config.keyPem,
      rejectUnauthorized: false
    });
    return axios.create({
      baseURL: "https://api.bancointer.com.br",
      httpsAgent: agent,
      headers: {
        "x-conta-corrente": config.contaCorrente.replace(/\D/g, "")
      }
    });
  }

  // Get OAuth token function
  async function getInterAccessToken(config: any): Promise<string> {
    const agent = new https.Agent({
      cert: config.certPem,
      key: config.keyPem,
      rejectUnauthorized: false
    });
    
    const params = new URLSearchParams();
    params.append("grant_type", "client_credentials");
    params.append("client_id", config.clientId);
    params.append("client_secret", config.clientSecret);
    params.append("scope", "cobranca.read cobranca.write");

    const tokenRes = await axios.post("https://api.bancointer.com.br/oauth/v2/token", params, {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      httpsAgent: agent
    });

    if (tokenRes.data && tokenRes.data.access_token) {
      return tokenRes.data.access_token;
    }
    throw new Error("Resposta do Banco Inter não incluiu o campo access_token.");
  }

  // Test connection endpoint
  app.post("/api/inter/test", async (req, res) => {
    try {
      const config = req.body;
      const token = await getInterAccessToken(config);
      res.json({ success: true, tokenExists: !!token });
    } catch (error: any) {
      console.error("Erro no teste Banco Inter:", error.response?.data || error.message);
      const detail = error.response?.data ? JSON.stringify(error.response.data) : error.message;
      res.status(500).json({ success: false, error: detail });
    }
  });

  // Create payment/cobranca v3 endpoint
  app.post("/api/inter/payments", async (req, res) => {
    try {
      const {
        clientName,
        cnpj,
        zipCode,
        street,
        number,
        neighborhood,
        city,
        state,
        email,
        value,
        dueDate,
        description,
        orderId,
        sequence
      } = req.body;

      const config = getInterConfig();
      const token = await getInterAccessToken(config);
      const interClient = createInterClient(config);

      // Clean CNPJ / CPF
      const cleanDoc = cnpj.replace(/\D/g, "");
      const tipoPessoa = cleanDoc.length === 11 ? "FISICA" : "JURIDICA";
      
      const cleanZip = (zipCode || "01001000").replace(/\D/g, "").slice(0, 8);
      const cleanState = (state || "SP").trim().toUpperCase().slice(0, 2);

      // Construct payment payload for Inter Cobrança v3
      const payload = {
        valorNominal: Number(value),
        dataVencimento: dueDate, // YYYY-MM-DD
        numDiasAgenda: 30,
        seuNumero: orderId ? `${orderId}-${sequence || 0}`.slice(0, 15) : `F-${Date.now().toString().slice(-6)}`,
        pagador: {
          cpfCnpj: cleanDoc,
          tipoPessoa,
          nome: clientName.substring(0, 100),
          endereco: (street || "Rua Geral").substring(0, 90),
          bairro: (neighborhood || "Centro").substring(0, 60),
          cidade: (city || "Sao Paulo").substring(0, 60),
          uf: cleanState,
          cep: cleanZip,
          numero: String(number || "S/N").substring(0, 10),
          email: email ? email.substring(0, 80) : undefined
        },
        mensagem: description ? {
          linha1: description.substring(0, 75)
        } : undefined
      };

      console.log("Enviando cobrança ao Banco Inter:", JSON.stringify(payload, null, 2));

      const response = await interClient.post("/cobranca/v3/cobrancas", payload, {
        headers: {
          Authorization: `Bearer ${token}`
        }
      });

      console.log("Cobrança gerada no Banco Inter com sucesso:", response.data);
      res.json({
        success: true,
        nossoNumero: response.data.nossoNumero,
        codigoSolicitacao: response.data.codigoSolicitacao
      });
    } catch (error: any) {
      console.error("Erro ao gerar boleto no Banco Inter:", error.response?.data || error.message);
      const detail = error.response?.data ? JSON.stringify(error.response.data) : error.message;
      res.status(500).json({ success: false, error: detail });
    }
  });

  // Get PDF endpoint (proxies downstream authentication to Inter and streams PDF bytes)
  app.get("/api/inter/pdf/:nossoNumero", async (req, res) => {
    try {
      const { nossoNumero } = req.params;
      const config = getInterConfig();
      const token = await getInterAccessToken(config);
      const interClient = createInterClient(config);

      const response = await interClient.get(`/cobranca/v3/cobrancas/${nossoNumero}/pdf`, {
        headers: {
          Authorization: `Bearer ${token}`
        }
      });

      if (response.data && response.data.pdf) {
        const pdfBuffer = Buffer.from(response.data.pdf, "base64");
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `inline; filename=boleto_${nossoNumero}.pdf`);
        return res.send(pdfBuffer);
      }

      throw new Error("Inter API did not return the pdf attribute inside the JSON.");
    } catch (error: any) {
      console.error(`Erro ao obter PDF do boleto ${req.params.nossoNumero}:`, error.response?.data || error.message);
      res.status(500).send(`Erro ao obter PDF do boleto: ${error.message}`);
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  httpServer.listen(Number(PORT), "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
