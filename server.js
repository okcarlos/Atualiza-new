require("dotenv").config();

const express = require("express");
const axios = require("axios");
const XLSX = require("xlsx");
const multer = require("multer");
const https = require("https");
const cors = require("cors");

// ============================================
// CONFIGURAÇÕES
// ============================================

const PORT = process.env.PORT || 3000;

// New Corban IEV
const NEWCORBAN_IEV_TOKEN = process.env.IEV_NEWCORBAN_TOKEN;
const NEWCORBAN_IEV_BASE_URL = process.env.IEV_NEWCORBAN_BASE_URL;

// New Corban CS
const NEWCORBAN_CS_TOKEN = process.env.CS_NEWCORBAN_TOKEN;
const NEWCORBAN_CS_BASE_URL = process.env.CS_NEWCORBAN_BASE_URL;

// IN100
const IN100_APIKEY = process.env.IN100_APIKEY;
const IN100_BASE_URL =
  process.env.IN100_BASE_URL || "https://integration.ajin.io";

// ============================================
// CONSTANTES
// ============================================

const STATUS_DESBLOQUEADO = 1;
const STATUS_BLOQUEADO = 3;

const INTERVALO_ENTRE_CONSULTAS = 1500;
const INTERVALO_ENTRE_PUTS = 1500;

const IN100_LAST_HOURS = 1;
const IN100_TIMEOUT = 120;

// ============================================
// EXPRESS
// ============================================

const app = express();

app.use(
  cors({
    origin: true,
    methods: ["GET", "POST", "PUT", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

app.use(express.json());

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024,
  },
});

// ============================================
// AGENT HTTPS
// ============================================

const httpsAgent = new https.Agent({
  family: 4,
  keepAlive: true,
});

// ============================================
// VALIDAÇÃO DAS CONFIGURAÇÕES
// ============================================

console.log("============================================");
console.log("CONFIGURAÇÃO DO SERVIDOR");
console.log("============================================");

if (!NEWCORBAN_IEV_TOKEN || !NEWCORBAN_IEV_BASE_URL) {
  console.log("⚠️ New Corban IEV não configurado.");
} else {
  console.log("✅ New Corban IEV configurado.");
}

if (!NEWCORBAN_CS_TOKEN || !NEWCORBAN_CS_BASE_URL) {
  console.log("⚠️ New Corban CS não configurado.");
} else {
  console.log("✅ New Corban CS configurado.");
}

if (!IN100_APIKEY) {
  console.log("⚠️ IN100 APIKEY não configurada.");
} else {
  console.log("✅ IN100 APIKEY configurada.");
}

console.log("============================================");

// ============================================
// ESTADO GLOBAL DO PROCESSAMENTO
// ============================================

let processamento = {
  executando: false,

  etapa: "parado",

  corban: null,

  total: 0,
  processados: 0,

  desbloqueados: 0,
  bloqueados: 0,

  bloqueadosConcessao: 0,
  bloqueadosBeneficiario: 0,
  beneficiosInvalidos: 0,

  erros: 0,

  atualizacoes: [],
  errosDetalhes: [],
  logs: [],

  arquivo: null,

  confirmado: false,

  // ==========================================
  // PROGRESSO DOS PUTS
  // ==========================================

  putTotal: 0,
  putProcessados: 0,
  putAtual: 0,
  putCpf: null,
  putBeneficio: null,
};

// ============================================
// CLIENTES SSE
// ============================================

const clientesSSE = new Set();

// ============================================
// CRIAR API NEW CORBAN
// ============================================

function criarAPI(corban) {
  let token;
  let baseURL;

  if (corban === "IEV") {
    token = NEWCORBAN_IEV_TOKEN;
    baseURL = NEWCORBAN_IEV_BASE_URL;
  } else if (corban === "CS") {
    token = NEWCORBAN_CS_TOKEN;
    baseURL = NEWCORBAN_CS_BASE_URL;
  } else {
    throw new Error(`New Corban inválido: ${corban}`);
  }

  if (!token || !baseURL) {
    throw new Error(
      `Configuração do New Corban ${corban} não encontrada.`
    );
  }

  return axios.create({
    baseURL,
    timeout: 15000,
    httpsAgent,

    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
  });
}

// ============================================
// API IN100
// ============================================

const apiIN100 = axios.create({
  baseURL: IN100_BASE_URL,
  timeout: 180000,
  httpsAgent,

  headers: {
    "Content-Type": "application/json",
    Accept: "application/json",
    apikey: IN100_APIKEY,
  },
});

// ============================================
// UTILITÁRIOS
// ============================================

function esperar(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function limparCPF(valor) {
  return String(valor ?? "").replace(/\D/g, "");
}

function somenteNumeros(valor) {
  return String(valor ?? "").replace(/\D/g, "");
}

function normalizarTexto(valor) {
  return String(valor ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

// ============================================
// NOVA LÓGICA DE FORMATAÇÃO
// ============================================
//
// PRIMEIRA COLUNA = CPF
// SEGUNDA COLUNA = BENEFÍCIO
//
// Os títulos das colunas NÃO importam.
// ============================================

function formatarCPF(valor) {
  let numero = somenteNumeros(valor);

  if (!numero) {
    return "";
  }

  // Completa até 11 dígitos
  numero = numero.padStart(11, "0");

  // Caso tenha mais de 11, mantém os últimos 11
  if (numero.length > 11) {
    numero = numero.slice(-11);
  }

  return `${numero.slice(0, 3)}.${numero.slice(
    3,
    6
  )}.${numero.slice(6, 9)}-${numero.slice(9, 11)}`;
}

function formatarBeneficio(valor) {
  let numero = somenteNumeros(valor);

  if (!numero) {
    return "";
  }

  // Completa até 10 dígitos
  numero = numero.padStart(11, "0");

  // Caso tenha mais de 10, mantém os últimos 10
  if (numero.length > 11) {
    numero = numero.slice(-11);
  }

  return numero;
}

// ============================================
// STATUS
// ============================================

function nomeStatus(status) {
  if (Number(status) === STATUS_DESBLOQUEADO) {
    return "DESBLOQUEADO";
  }

  if (Number(status) === STATUS_BLOQUEADO) {
    return "BLOQUEADO";
  }

  return String(status ?? "");
}

// ============================================
// SSE
// ============================================

function enviarEvento(tipo, dados) {
  const mensagem = `data: ${JSON.stringify({
    tipo,
    dados,
  })}\n\n`;

  for (const cliente of clientesSSE) {
    try {
      cliente.write(mensagem);
    } catch (erro) {
      clientesSSE.delete(cliente);
    }
  }
}

// ============================================
// LOG
// ============================================

function log(mensagem, nivel = "info") {
  const item = {
    timestamp: new Date().toISOString(),
    mensagem,
    nivel,
  };

  processamento.logs.push(item);

  // Mantém no máximo 100 logs
  if (processamento.logs.length > 100) {
    processamento.logs.shift();
  }

  enviarEvento("log", item);
}

// ============================================
// ENVIAR ESTADO
// ============================================

function enviarEstado() {
  const estado = {
    executando: processamento.executando,
    etapa: processamento.etapa,

    corban: processamento.corban,
    newCorban: processamento.corban,

    total: processamento.total,
    processados: processamento.processados,

    desbloqueados: processamento.desbloqueados,
    bloqueados: processamento.bloqueados,

    bloqueadosConcessao:
      processamento.bloqueadosConcessao,

    bloqueadosBeneficiario:
      processamento.bloqueadosBeneficiario,

    beneficiosInvalidos:
      processamento.beneficiosInvalidos,

    erros: processamento.erros,

    atualizacoes: processamento.atualizacoes.map(
      (item) => ({
        cpf: item.cpf,
        cliente: item.cliente,
        customerId: item.customerId,

        beneficio: item.beneficio,
        benefitId: item.benefitId,

        statusAtual: item.statusAtual,
        novoStatus: item.novoStatus,

        statusNome: item.statusNome,

        in100Status: item.in100Status,
        blockType: item.blockType,
        blockCategory: item.blockCategory,

        benefitStatus: item.benefitStatus,
        benefitSituation: item.benefitSituation,

        mensagemIN100: item.mensagemIN100,

        resultado: item.resultado,

        detalhe: item.detalhe || null,
      })
    ),

    errosDetalhes: processamento.errosDetalhes,

    logs: processamento.logs,

    confirmado: processamento.confirmado,

    // ==========================================
    // PROGRESSO DOS PUTS
    // ==========================================

    putTotal: processamento.putTotal,
    putProcessados: processamento.putProcessados,
    putAtual: processamento.putAtual,
    putCpf: processamento.putCpf,
    putBeneficio: processamento.putBeneficio,
  };

  enviarEvento("estado", estado);
}

// ============================================
// CLASSIFICAR RESPOSTA IN100
// ============================================

function classificarMensagemIN100(mensagem) {
  const texto = normalizarTexto(mensagem);

  if (
    texto.includes(
      "beneficio bloqueado durante o processo de concessao"
    )
  ) {
    return {
      blockType: "blocked_during_concession",
      blockCategory: "CONCESSAO",
      status: STATUS_BLOQUEADO,
      atualizar: true,
    };
  }

  if (
    texto.includes(
      "beneficio bloqueado pelo beneficiario"
    )
  ) {
    return {
      blockType: "blocked_by_beneficiary",
      blockCategory: "BENEFICIARIO",
      status: STATUS_BLOQUEADO,
      atualizar: true,
    };
  }

  if (
    texto.includes(
      "numero do beneficio invalido"
    )
  ) {
    return {
      blockType: "invalid_benefit_number",
      blockCategory: "BENEFICIO_INVALIDO",
      status: null,
      atualizar: false,
    };
  }

  return null;
}

// ============================================
// CONVERTER IN100 PARA STATUS
// ============================================

function converterIN100ParaStatus(blockType) {
  if (!blockType) {
    return null;
  }

  if (blockType === "not_blocked") {
    return STATUS_DESBLOQUEADO;
  }

  return STATUS_BLOQUEADO;
}

// ============================================
// LER PLANILHA
// ============================================

function lerPlanilha(buffer) {
  const workbook = XLSX.read(buffer, {
    type: "buffer",
    cellDates: false,
    raw: true,
  });

  if (!workbook.SheetNames.length) {
    throw new Error("A planilha não possui nenhuma aba.");
  }

  const nomeAba = workbook.SheetNames[0];
  const sheet = workbook.Sheets[nomeAba];

  // ==========================================
  // IMPORTANTE:
  //
  // header: 1 faz a leitura pela posição.
  // Não dependemos do nome das colunas.
  // ==========================================

  const dados = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: "",
    raw: true,
  });

  return dados;
}

// ============================================
// REMOVER DUPLICADOS
// ============================================

function removerDuplicados(linhas) {
  const vistos = new Set();
  const resultado = [];

  for (const linha of linhas) {
    const cpf = limparCPF(linha[0]);
    const beneficio = somenteNumeros(linha[1]);

    if (!cpf || !beneficio) {
      resultado.push(linha);
      continue;
    }

    const chave = `${cpf}|${beneficio}`;

    if (vistos.has(chave)) {
      continue;
    }

    vistos.add(chave);
    resultado.push(linha);
  }

  return resultado;
}

// ============================================
// AGRUPAR POR CPF
// ============================================

function agruparPorCPF(linhas) {
  const mapa = new Map();

  for (const linha of linhas) {
    const cpf = limparCPF(linha[0]);

    if (!cpf) {
      continue;
    }

    if (!mapa.has(cpf)) {
      mapa.set(cpf, []);
    }

    mapa.get(cpf).push(linha);
  }

  return mapa;
}

// ============================================
// BUSCAR CLIENTE NO NEW CORBAN
// ============================================

async function buscarClienteComRetry(api, cpf) {
  const MAX_TENTATIVAS = 6;

  for (let tentativa = 1; tentativa <= MAX_TENTATIVAS; tentativa++) {
    try {
      const response = await api.get(
        `/customers/cpf/${cpf}`
      );

      return response.data;
    } catch (erro) {
      const status = erro.response?.status;

      if (status === 429 && tentativa < MAX_TENTATIVAS) {
        const espera = 800 * tentativa;

        log(
          `429 ao consultar cliente ${cpf}. Tentativa ${tentativa}/${MAX_TENTATIVAS}. Aguardando ${espera}ms.`,
          "warning"
        );

        await esperar(espera);
        continue;
      }

      throw erro;
    }
  }
}

// ============================================
// ATUALIZAR BENEFÍCIO
// ============================================

async function atualizarBeneficioComRetry(
  api,
  customerId,
  benefitId,
  dados
) {
  const MAX_TENTATIVAS = 6;

  for (let tentativa = 1; tentativa <= MAX_TENTATIVAS; tentativa++) {
    try {
      const response = await api.put(
        `/customers/${customerId}/benefits/${benefitId}`,
        dados
      );

      return response.data;
    } catch (erro) {
      const status = erro.response?.status;

      if (status === 429 && tentativa < MAX_TENTATIVAS) {
        const espera = 800 * tentativa;

        log(
          `429 ao atualizar benefício ${benefitId}. Tentativa ${tentativa}/${MAX_TENTATIVAS}. Aguardando ${espera}ms.`,
          "warning"
        );

        await esperar(espera);
        continue;
      }

      throw erro;
    }
  }
}

// ============================================
// CONSULTAR IN100
// ============================================

async function consultarIN100(cpf, beneficio) {
  try {
    const response = await apiIN100.post(
      "/v3/query-inss-balances/finder/await",
      {
        identity: cpf,
        benefitNumber: beneficio,
        lastHours: IN100_LAST_HOURS,
        timeout: IN100_TIMEOUT,
      }
    );

    return {
      sucesso: true,
      statusHTTP: response.status,
      blockType: response.data?.blockType || null,
      margem:
        response.data?.consignedCreditBalance ??
        null,
      mensagem: null,
    };
  } catch (error) {
    if (error.response) {
      const statusHTTP = error.response.status;

      const mensagem =
        error.response?.data?.messages?.[0]?.text ||
        null;

      // ========================================
      // HTTP 400
      // ========================================

      if (statusHTTP === 400) {
        const classificacao =
          classificarMensagemIN100(mensagem);

        if (classificacao) {
          return {
            sucesso: false,
            statusHTTP,
            blockType: classificacao.blockType,
            blockCategory: classificacao.blockCategory,
            status: classificacao.status,
            atualizar: classificacao.atualizar,
            margem: null,
            mensagem,
          };
        }
      }

      throw new Error(
        mensagem ||
          `Erro ao consultar IN100: HTTP ${statusHTTP}`
      );
    }

    throw new Error(
      `Erro ao consultar IN100: ${
        error.code || error.message
      }`
    );
  }
}

// ============================================
// MONTAR DADOS DO PUT
// ============================================

function montarDadosPUT(beneficio, novoStatus) {
  const dados = {
    registration_number:
      beneficio.registration_number,

    benefit_species:
      beneficio.benefit_species,

    covenant_id:
      beneficio.covenant_id,

    state:
      beneficio.state,

    benefit_status:
      novoStatus,

    benefit_dispatch_date:
      beneficio.benefit_dispatch_date
        ? String(
            beneficio.benefit_dispatch_date
          ).slice(0, 10)
        : null,

    unblock_date:
      beneficio.unblock_date
        ? String(
            beneficio.unblock_date
          ).slice(0, 10)
        : null,

    margin:
      beneficio.margin,

    card_margin:
      beneficio.card_margin,

    calculation_base:
      beneficio.calculation_base,
  };

  return dados;
}

// ============================================
// ADICIONAR ERRO
// ============================================

function adicionarErro(
  cpf,
  beneficio,
  mensagem,
  etapa = "processamento"
) {
  processamento.erros++;

  const detalhe = {
    cpf,
    beneficio,
    mensagem,
    etapa,
    timestamp: new Date().toISOString(),
  };

  processamento.errosDetalhes.push(detalhe);

  log(
    `Erro — CPF ${cpf} — Benefício ${beneficio}: ${mensagem}`,
    "error"
  );
}

// ============================================
// PROCESSAR PLANILHA
// ============================================

async function processarPlanilha(
  buffer,
  nomeArquivo,
  corban
) {
  if (processamento.executando) {
    throw new Error(
      "Já existe um processamento em andamento."
    );
  }

  // ==========================================
  // RESET
  // ==========================================

  processamento = {
    executando: true,

    etapa: "consultando",

    corban,

    total: 0,
    processados: 0,

    desbloqueados: 0,
    bloqueados: 0,

    bloqueadosConcessao: 0,
    bloqueadosBeneficiario: 0,
    beneficiosInvalidos: 0,

    erros: 0,

    atualizacoes: [],
    errosDetalhes: [],
    logs: [],

    arquivo: nomeArquivo,

    confirmado: false,

    putTotal: 0,
    putProcessados: 0,
    putAtual: 0,
    putCpf: null,
    putBeneficio: null,
  };

  enviarEstado();

  log(`Arquivo recebido: ${nomeArquivo}`);
  log(`New Corban selecionado: ${corban}`);

  // ==========================================
  // API
  // ==========================================

  const api = criarAPI(corban);

  // ==========================================
  // LER PLANILHA
  // ==========================================

  let dados;

  try {
    dados = lerPlanilha(buffer);
  } catch (erro) {
    throw new Error(
      `Erro ao ler a planilha: ${erro.message}`
    );
  }

  if (!dados.length) {
    throw new Error("A planilha está vazia.");
  }

  // ==========================================
  // NOVA LÓGICA:
  //
  // NÃO verificamos cabeçalho CPF/BENEFICIO.
  //
  // Primeira coluna = CPF
  // Segunda coluna = benefício
  // ==========================================

  const linhasDados = dados.slice(1);

  if (!linhasDados.length) {
    throw new Error(
      "A planilha não possui dados para processar."
    );
  }

  // ==========================================
  // REMOVER DUPLICADOS
  // ==========================================

  const linhasSemDuplicados =
    removerDuplicados(linhasDados);

  const duplicadosRemovidos =
    linhasDados.length -
    linhasSemDuplicados.length;

  if (duplicadosRemovidos > 0) {
    log(
      `${duplicadosRemovidos} registro(s) duplicado(s) removido(s).`
    );
  }

  // ==========================================
  // TOTAL
  // ==========================================

  processamento.total =
    linhasSemDuplicados.length;

  enviarEstado();

  // ==========================================
  // AGRUPAR POR CPF
  // ==========================================

  const grupos = agruparPorCPF(
    linhasSemDuplicados
  );

  // ==========================================
  // PROCESSAR CPF POR CPF
  // ==========================================

  for (const [cpf, linhasCPF] of grupos) {
    if (!processamento.executando) {
      break;
    }

    // ========================================
    // VALIDAR CPF
    // ========================================

    if (cpf.length !== 11) {
      for (const linha of linhasCPF) {
        const beneficio = formatarBeneficio(
          linha[1]
        );

        adicionarErro(
          formatarCPF(cpf),
          beneficio,
          "CPF inválido. É necessário possuir 11 dígitos."
        );

        processamento.processados++;

        enviarEstado();
      }

      continue;
    }

    // ========================================
    // BUSCAR CLIENTE
    // ========================================

    let cliente;

    try {
      cliente = await buscarClienteComRetry(
        api,
        cpf
      );
    } catch (erro) {
      for (const linha of linhasCPF) {
        const beneficio = formatarBeneficio(
          linha[1]
        );

        adicionarErro(
          formatarCPF(cpf),
          beneficio,
          erro.response?.data?.message ||
            erro.response?.data?.messages?.[0]
              ?.text ||
            erro.message,
          "consulta_cliente"
        );

        processamento.processados++;

        enviarEstado();
      }

      continue;
    }

    if (!cliente) {
      for (const linha of linhasCPF) {
        const beneficio = formatarBeneficio(
          linha[1]
        );

        adicionarErro(
          formatarCPF(cpf),
          beneficio,
          "Cliente não encontrado no New Corban.",
          "consulta_cliente"
        );

        processamento.processados++;

        enviarEstado();
      }

      continue;
    }

    const clienteNome =
      cliente.name ||
      cliente.nome ||
      cliente.full_name ||
      "";

    const customerId =
      cliente.id ||
      cliente.customer_id;

    const beneficios =
      Array.isArray(cliente.benefits)
        ? cliente.benefits
        : [];

    // ========================================
    // PROCESSAR BENEFÍCIOS DO CPF
    // ========================================

    for (const linha of linhasCPF) {
      if (!processamento.executando) {
        break;
      }

      // ======================================
      // FORMATAÇÃO PELA POSIÇÃO
      // ======================================

      const cpfFormatado =
        formatarCPF(linha[0]);

      const beneficioFormatado =
        formatarBeneficio(linha[1]);

      const beneficio =
        somenteNumeros(beneficioFormatado);

      // ======================================
      // VALIDAR BENEFÍCIO
      // ======================================

      if (!beneficio || beneficio.length !== 10) {
        adicionarErro(
          cpfFormatado,
          beneficioFormatado,
          "Número do benefício inválido.",
          "validacao"
        );

        processamento.processados++;

        enviarEstado();

        continue;
      }

      // ======================================
      // PROCURAR BENEFÍCIO
      // ======================================

      const beneficioEncontrado =
        beneficios.find((item) => {
          const numero =
            somenteNumeros(
              item.registration_number
            );

          return numero === beneficio;
        });

      if (!beneficioEncontrado) {
        adicionarErro(
          cpfFormatado,
          beneficioFormatado,
          "Benefício não encontrado no cliente.",
          "consulta_beneficio"
        );

        processamento.processados++;

        enviarEstado();

        continue;
      }

      // ======================================
      // CONSULTAR IN100
      // ======================================

      let resultadoIN100;

      try {
        resultadoIN100 =
          await consultarIN100(
            cpf,
            beneficio
          );
      } catch (erro) {
        adicionarErro(
          cpfFormatado,
          beneficioFormatado,
          erro.message,
          "consulta_in100"
        );

        processamento.processados++;

        enviarEstado();

        await esperar(
          INTERVALO_ENTRE_CONSULTAS
        );

        continue;
      }

      // ======================================
      // BENEFÍCIO INVÁLIDO
      // ======================================

      if (
        resultadoIN100.blockType ===
        "invalid_benefit_number"
      ) {
        processamento.beneficiosInvalidos++;

        adicionarErro(
          cpfFormatado,
          beneficioFormatado,
          resultadoIN100.mensagem ||
            "Número do benefício inválido no IN100.",
          "consulta_in100"
        );

        processamento.processados++;

        enviarEstado();

        await esperar(
          INTERVALO_ENTRE_CONSULTAS
        );

        continue;
      }

      // ======================================
      // DETERMINAR NOVO STATUS
      // ======================================

      let novoStatus = null;

      if (
        resultadoIN100.status !== undefined &&
        resultadoIN100.status !== null
      ) {
        novoStatus = resultadoIN100.status;
      } else {
        novoStatus =
          converterIN100ParaStatus(
            resultadoIN100.blockType
          );
      }

      if (novoStatus === null) {
        adicionarErro(
          cpfFormatado,
          beneficioFormatado,
          "Não foi possível determinar o status através do IN100.",
          "consulta_in100"
        );

        processamento.processados++;

        enviarEstado();

        await esperar(
          INTERVALO_ENTRE_CONSULTAS
        );

        continue;
      }

      // ======================================
      // CATEGORIA DO BLOQUEIO
      // ======================================

      if (
        resultadoIN100.blockCategory ===
        "CONCESSAO"
      ) {
        processamento.bloqueadosConcessao++;
      }

      if (
        resultadoIN100.blockCategory ===
        "BENEFICIARIO"
      ) {
        processamento.bloqueadosBeneficiario++;
      }

      // ======================================
      // STATUS ATUAL
      // ======================================

      const statusAtual = Number(
        beneficioEncontrado.benefit_status
      );

      // ======================================
      // SE NÃO PRECISA ALTERAR
      // ======================================

      if (statusAtual === novoStatus) {
        processamento.processados++;

        log(
          `CPF ${cpfFormatado} — Benefício ${beneficioFormatado}: já está ${nomeStatus(
            novoStatus
          )}. Nenhuma alteração necessária.`
        );

        enviarEstado();

        await esperar(
          INTERVALO_ENTRE_CONSULTAS
        );

        continue;
      }

      // ======================================
      // CONTADORES
      // ======================================

      if (
        novoStatus === STATUS_DESBLOQUEADO
      ) {
        processamento.desbloqueados++;
      }

      if (
        novoStatus === STATUS_BLOQUEADO
      ) {
        processamento.bloqueados++;
      }

      // ======================================
      // DADOS DO PUT
      // ======================================

      const dadosPUT = montarDadosPUT(
        beneficioEncontrado,
        novoStatus
      );

      // ======================================
      // ADICIONAR À FILA DE ATUALIZAÇÃO
      // ======================================

      processamento.atualizacoes.push({
        cpf: cpfFormatado,

        cliente: clienteNome,

        customerId,

        beneficio: beneficioFormatado,

        benefitId: beneficioEncontrado.id,

        statusAtual,

        novoStatus,

        statusNome: nomeStatus(novoStatus),

        in100Status:
          resultadoIN100.sucesso
            ? resultadoIN100.blockType
            : resultadoIN100.status,

        blockType:
          resultadoIN100.blockType || null,

        blockCategory:
          resultadoIN100.blockCategory || null,

        benefitStatus:
          beneficioEncontrado.benefit_status,

        benefitSituation:
          beneficioEncontrado.benefit_situation,

        mensagemIN100:
          resultadoIN100.mensagem || null,

        dadosPUT,

        resultado: null,
      });

      processamento.processados++;

      log(
        `CPF ${cpfFormatado} — Benefício ${beneficioFormatado}: ${nomeStatus(
          statusAtual
        )} → ${nomeStatus(novoStatus)}`
      );

      enviarEstado();

      await esperar(
        INTERVALO_ENTRE_CONSULTAS
      );
    }
  }

  // ==========================================
  // FINAL DA ANÁLISE
  // ==========================================

  if (!processamento.executando) {
    processamento.etapa = "cancelado";

    log(
      "Processamento cancelado pelo usuário.",
      "warning"
    );

    enviarEstado();

    return;
  }

  processamento.executando = false;
  processamento.etapa =
    "aguardando_confirmacao";

  log(
    `Análise concluída. ${processamento.atualizacoes.length} benefício(s) aguardando atualização.`
  );

  enviarEstado();
}

// ============================================
// EXECUTAR ATUALIZAÇÕES
// ============================================

async function executarAtualizacoes() {
  if (processamento.executando) {
    throw new Error(
      "Já existe um processamento em andamento."
    );
  }

  if (
    processamento.etapa !==
    "aguardando_confirmacao"
  ) {
    throw new Error(
      "O processamento não está aguardando confirmação."
    );
  }

  if (!processamento.atualizacoes.length) {
    throw new Error(
      "Não existem atualizações para realizar."
    );
  }

  const api = criarAPI(
    processamento.corban
  );

  processamento.executando = true;
  processamento.etapa = "atualizando";

  processamento.putTotal =
    processamento.atualizacoes.length;

  processamento.putProcessados = 0;
  processamento.putAtual = 0;
  processamento.putCpf = null;
  processamento.putBeneficio = null;

  enviarEstado();

  log(
    `Iniciando ${processamento.putTotal} atualização(ões) no New Corban ${processamento.corban}.`
  );

  for (
    let indice = 0;
    indice < processamento.atualizacoes.length;
    indice++
  ) {
    if (!processamento.executando) {
      break;
    }

    const item =
      processamento.atualizacoes[indice];

    processamento.putAtual = indice + 1;
    processamento.putCpf = item.cpf;
    processamento.putBeneficio =
      item.beneficio;

    enviarEvento("progresso_put", {
      atual: indice + 1,
      total: processamento.putTotal,
      cpf: item.cpf,
      beneficio: item.beneficio,
    });

    enviarEstado();

    try {
      // ========================================
      // PUT
      // ========================================

      await atualizarBeneficioComRetry(
        api,
        item.customerId,
        item.benefitId,
        item.dadosPUT
      );

      log(
        `PUT realizado — CPF ${item.cpf} — Benefício ${item.beneficio}.`
      );

      // ========================================
      // VERIFICAR NOVAMENTE
      // ========================================

      await esperar(1000);

      const clienteAtualizado =
        await buscarClienteComRetry(
          api,
          somenteNumeros(item.cpf)
        );

      const beneficioVerificado =
        clienteAtualizado?.benefits?.find(
          (beneficio) =>
            String(beneficio.id) ===
            String(item.benefitId)
        );

      if (
        beneficioVerificado &&
        Number(
          beneficioVerificado.benefit_status
        ) === Number(item.novoStatus)
      ) {
        item.resultado = "SUCESSO";

        log(
          `Confirmado — CPF ${item.cpf} — Benefício ${item.beneficio} → ${item.statusNome}.`
        );
      } else {
        item.resultado =
          "PUT REALIZADO - NÃO CONFIRMADO";

        log(
          `PUT realizado, mas não confirmado — CPF ${item.cpf} — Benefício ${item.beneficio}.`,
          "warning"
        );
      }
    } catch (erro) {
      item.resultado = "ERRO";

      item.detalhe =
        erro.response?.data?.message ||
        erro.response?.data?.messages?.[0]
          ?.text ||
        erro.message;

      log(
        `Erro no PUT — CPF ${item.cpf} — Benefício ${item.beneficio}: ${item.detalhe}`,
        "error"
      );
    }

    processamento.putProcessados++;

    enviarEstado();

    if (
      processamento.executando &&
      indice <
        processamento.atualizacoes.length - 1
    ) {
      await esperar(
        INTERVALO_ENTRE_PUTS
      );
    }
  }

  // ==========================================
  // FINAL
  // ==========================================

  if (!processamento.executando) {
    processamento.etapa = "cancelado";

    log(
      "Atualização cancelada pelo usuário.",
      "warning"
    );

    enviarEstado();

    return;
  }

  processamento.executando = false;
  processamento.etapa = "finalizado";

  processamento.putProcessados =
    processamento.putTotal;

  log(
    "Todas as atualizações foram processadas."
  );

  enviarEstado();
}

// ============================================
// SSE
// ============================================

app.get("/api/events", (req, res) => {
  res.setHeader(
    "Content-Type",
    "text/event-stream"
  );

  res.setHeader(
    "Cache-Control",
    "no-cache, no-transform"
  );

  res.setHeader(
    "Connection",
    "keep-alive"
  );

  res.setHeader(
    "X-Accel-Buffering",
    "no"
  );

  res.setHeader(
    "Access-Control-Allow-Origin",
    "*"
  );

  res.flushHeaders();

  res.write(": conectado\n\n");

  clientesSSE.add(res);

  // ==========================================
  // ENVIAR ESTADO IMEDIATAMENTE
  // ==========================================

  const estado = {
    executando:
      processamento.executando,

    etapa:
      processamento.etapa,

    corban:
      processamento.corban,

    newCorban:
      processamento.corban,

    total:
      processamento.total,

    processados:
      processamento.processados,

    desbloqueados:
      processamento.desbloqueados,

    bloqueados:
      processamento.bloqueados,

    bloqueadosConcessao:
      processamento.bloqueadosConcessao,

    bloqueadosBeneficiario:
      processamento.bloqueadosBeneficiario,

    beneficiosInvalidos:
      processamento.beneficiosInvalidos,

    erros:
      processamento.erros,

    atualizacoes:
      processamento.atualizacoes,

    errosDetalhes:
      processamento.errosDetalhes,

    logs:
      processamento.logs,

    confirmado:
      processamento.confirmado,

    putTotal:
      processamento.putTotal,

    putProcessados:
      processamento.putProcessados,

    putAtual:
      processamento.putAtual,

    putCpf:
      processamento.putCpf,

    putBeneficio:
      processamento.putBeneficio,
  };

  res.write(
    `data: ${JSON.stringify({
      tipo: "estado",
      dados: estado,
    })}\n\n`
  );

  // ==========================================
  // HEARTBEAT
  // ==========================================

  const heartbeat = setInterval(() => {
    try {
      res.write(": heartbeat\n\n");
    } catch (erro) {
      clearInterval(heartbeat);
      clientesSSE.delete(res);
    }
  }, 15000);

  // ==========================================
  // DESCONEXÃO
  // ==========================================

  req.on("close", () => {
    clearInterval(heartbeat);
    clientesSSE.delete(res);

    try {
      res.end();
    } catch (_) {}
  });
});

// ============================================
// STATUS
// ============================================

app.get("/api/status", (req, res) => {
  res.json({
    online: true,

    ...processamento,

    newCorban:
      processamento.corban,
  });
});

// ============================================
// PROCESSAR
// ============================================

app.post(
  "/api/processar",
  upload.single("arquivo"),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({
          erro: "Envie uma planilha.",
        });
      }

      const corban = req.body.corban;

      if (
        corban !== "IEV" &&
        corban !== "CS"
      ) {
        return res.status(400).json({
          erro:
            "Selecione um New Corban válido: IEV ou CS.",
        });
      }

      if (processamento.executando) {
        return res.status(409).json({
          erro:
            "Já existe um processamento em andamento.",
        });
      }

      res.json({
        sucesso: true,
        mensagem:
          "Processamento iniciado.",
      });

      processarPlanilha(
        req.file.buffer,
        req.file.originalname,
        corban
      ).catch((erro) => {
        console.error(
          "Erro no processamento:",
          erro
        );

        processamento.executando = false;
        processamento.etapa = "erro";

        adicionarErro(
          "",
          "",
          erro.message,
          "processamento"
        );

        enviarEstado();
      });
    } catch (erro) {
      console.error(erro);

      return res.status(500).json({
        erro:
          erro.message ||
          "Não foi possível iniciar o processamento.",
      });
    }
  }
);

// ============================================
// CONFIRMAR
// ============================================

app.post(
  "/api/confirmar",
  async (req, res) => {
    try {
      if (processamento.executando) {
        return res.status(409).json({
          erro:
            "Já existe um processamento em andamento.",
        });
      }

      if (
        processamento.etapa !==
        "aguardando_confirmacao"
      ) {
        return res.status(400).json({
          erro:
            "O processamento não está aguardando confirmação.",
        });
      }

      if (
        req.body?.confirmar !== true
      ) {
        return res.status(400).json({
          erro:
            "Confirmação não enviada.",
        });
      }

      processamento.confirmado = true;

      res.json({
        sucesso: true,
        mensagem:
          "Atualização iniciada.",
      });

      executarAtualizacoes().catch(
        (erro) => {
          console.error(
            "Erro nas atualizações:",
            erro
          );

          processamento.executando =
            false;

          processamento.etapa = "erro";

          log(
            `Erro nas atualizações: ${erro.message}`,
            "error"
          );

          enviarEstado();
        }
      );
    } catch (erro) {
      return res.status(500).json({
        erro:
          erro.message ||
          "Não foi possível confirmar a atualização.",
      });
    }
  }
);

// ============================================
// CANCELAR
// ============================================

app.post(
  "/api/cancelar",
  (req, res) => {
    if (!processamento.executando) {
      processamento.etapa = "cancelado";

      log(
        "Processamento cancelado.",
        "warning"
      );

      enviarEstado();

      return res.json({
        sucesso: true,
        mensagem:
          "Processamento cancelado.",
      });
    }

    processamento.executando = false;
    processamento.etapa = "cancelado";

    log(
      "Cancelamento solicitado pelo usuário.",
      "warning"
    );

    enviarEstado();

    res.json({
      sucesso: true,
      mensagem:
        "Cancelamento solicitado.",
    });
  }
);

// ============================================
// HEALTH CHECK
// ============================================

app.get("/", (req, res) => {
  res.json({
    online: true,
    servico:
      "Atualização de Benefícios - New Corban + IN100",
    etapa: processamento.etapa,
    executando:
      processamento.executando,
  });
});

// ============================================
// INICIAR SERVIDOR
// ============================================

app.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log(
      `Servidor rodando na porta ${PORT}`
    );
  }
);
